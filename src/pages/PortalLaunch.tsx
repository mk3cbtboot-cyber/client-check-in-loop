import { Navigate } from "react-router-dom";

/**
 * Entry point used by the installed PWA (manifest start_url = "/portal").
 * Sends the client back into their portal using the last token they opened.
 */
const PortalLaunch = () => {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("tenacia_portal_token") : null;
  return <Navigate to={token ? `/portal/${token}` : "/auth"} replace />;
};

export default PortalLaunch;
