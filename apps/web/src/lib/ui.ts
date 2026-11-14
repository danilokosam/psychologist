/**
 * Shared class strings for the handful of element styles every screen uses.
 * Plain strings rather than wrapper components, so a native <select> or
 * <Link> keeps its full API -- and there is one place to change a button.
 *
 * Motion budget: `transition-colors` (150ms) on interactive elements is the
 * only animation besides the loading spinner (see globals.css).
 */
const interactive = 'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50';

const control = `rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted aria-[invalid=true]:border-danger ${interactive}`;

export const ui = {
  page: 'mx-auto w-full space-y-6 px-4 py-6 sm:px-6',
  card: 'rounded-xl border border-border bg-surface p-5 shadow-sm',
  h1: 'text-2xl font-semibold tracking-tight text-foreground',
  h2: 'text-base font-semibold text-foreground',
  muted: 'text-sm text-muted',
  label: 'block text-sm font-medium text-foreground',
  /** A form control that fills its container. */
  input: `w-full ${control}`,
  /** The same control at its natural width (toolbars, inline pickers). */
  inputInline: `w-auto ${control}`,
  fieldError: 'text-xs text-danger',
  link: `font-medium text-link underline-offset-4 hover:underline ${interactive}`,
  button: {
    primary: `inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary-hover ${interactive}`,
    secondary: `inline-flex items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted ${interactive}`,
    danger: `inline-flex items-center justify-center gap-2 rounded-lg bg-danger-soft px-4 py-2 text-sm font-medium text-danger hover:brightness-95 ${interactive}`,
    ghost: `inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-surface-muted hover:text-foreground ${interactive}`,
  },
} as const;
