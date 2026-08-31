import { useEffect, useState } from "react";
import { Share, X, Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "tenacia_install_banner_dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
}

/** Client-portal-only "add to home screen" helper. Never rendered for practitioners. */
const InstallAppBanner = () => {
  const [dismissed, setDismissed] = useState(true);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    setDismissed(false);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      window.localStorage.setItem(DISMISS_KEY, "1");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      window.localStorage.setItem(DISMISS_KEY, "1");
      setDismissed(true);
    }
    setDeferredPrompt(null);
  };

  const ios = isIos();
  if (dismissed || installed) return null;
  if (!ios && !deferredPrompt) return null;

  return (
    <div className="relative mb-4 rounded-lg border bg-card p-4 shadow-sm">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install banner"
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-muted"
      >
        <X className="h-4 w-4" />
      </button>

      {ios ? (
        <div className="pr-6">
          <p className="font-medium">Add Tenacia to your Home Screen</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Tap the Share button
            <span className="mx-1 inline-flex items-center rounded border border-primary/40 bg-primary/10 px-1 py-0.5 align-middle text-primary">
              <Share className="h-3.5 w-3.5" />
            </span>
            in your browser bar, then choose
            <span className="mx-1 inline-flex items-center gap-1 rounded border px-1 py-0.5 align-middle">
              <Plus className="h-3.5 w-3.5" /> Add to Home Screen
            </span>
            .
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The Share button is at the bottom of Safari on iPhone, and at the top on iPad.
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-4 pr-6">
          <div>
            <p className="font-medium">Install Tenacia</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add the portal to your home screen for quick, full-screen access.
            </p>
          </div>
          <Button onClick={install} className="shrink-0">
            <Download className="mr-2 h-4 w-4" />
            Install app
          </Button>
        </div>
      )}
    </div>
  );
};

export default InstallAppBanner;
