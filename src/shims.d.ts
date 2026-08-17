/**
 * Ambient declarations for the two harness packages this plugin loads at
 * runtime through a profile-anchored `createRequire` (the pnpm-link safe
 * pattern used by deepseek-harness-quota-monitor). Only the exact surfaces
 * this plugin uses are declared; the published registry versions of these
 * packages lag the deployment, so type truth lives here.
 */

declare module '@deepseek-ai/dsh-settings' {
  import type { Context } from '@deepseek-ai/cordis'
  import type { z } from '@deepseek-ai/schemastery'

  export type SettingsNamespace = string

  export interface SettingsSectionHooks<T> {
    setSource(current: () => T): void
    onChange(): void
    validate?(value: T): void
  }

  export function settingsNamespace(ns: string): SettingsNamespace

  export function installSettingsSection<T>(
    ctx: Context,
    ns: SettingsNamespace,
    schema: z<T>,
    entry: T,
    hooks: SettingsSectionHooks<T>,
  ): void
}
