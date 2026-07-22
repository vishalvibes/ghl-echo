import "@testing-library/jest-dom/vitest"

import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Unmount React trees between tests so DOM assertions never leak across cases.
afterEach(() => {
  cleanup()
})

// jsdom has no matchMedia implementation; components like the sidebar's
// useIsMobile hook need a stub so they don't throw during render.
window.matchMedia ??= (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})
