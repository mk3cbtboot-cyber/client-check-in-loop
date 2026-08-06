/// <reference types="npm:@types/react@18.3.1" />

import type * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  /** Static subject line, or a function of the template data. */
  subject: string | ((data: Record<string, unknown>) => string)
  displayName?: string
  previewData?: Record<string, unknown>
}

import { template as clientInvite } from './client-invite.tsx'

/**
 * Registry of app (transactional) email templates.
 * Add new templates here with a kebab-case key.
 */
export const TEMPLATES: Record<string, TemplateEntry> = {
  'client-invite': clientInvite,
}

export function resolveSubject(entry: TemplateEntry, data: Record<string, unknown>): string {
  return typeof entry.subject === 'function' ? entry.subject(data) : entry.subject
}
