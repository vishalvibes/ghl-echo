"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  ListTodo,
  MessagesSquare,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type NavItem = { href: string; label: string; icon: LucideIcon }

// One entry per demo surface. Add a route under src/app/(app)/ and a line here.
const NAV: NavItem[] = [
  { href: "/chat", label: "Chat", icon: MessagesSquare },
  { href: "/inference", label: "Inference", icon: Sparkles },
  { href: "/todos", label: "Todos", icon: ListTodo },
  { href: "/health", label: "Health", icon: Activity },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth()
  const pathname = usePathname()

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-4 py-3">
          <Link href="/chat" className="text-sm font-semibold tracking-tight">
            Template
          </Link>

          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </Link>
              )
            })}
          </nav>

          <span className="hidden max-w-40 truncate text-xs text-muted-foreground sm:inline">
            {user?.email ?? user?.id}
          </span>
          <Button variant="outline" size="sm" onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
        {children}
      </div>
    </div>
  )
}
