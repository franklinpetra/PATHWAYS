import Link from "next/link";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { Logo } from "@/components/brand/Logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 h-14 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-gutter">
        <Link href="/" aria-label="Pathways home" className="rounded-full">
          <Logo size="sm" />
        </Link>
        <nav className="flex items-center gap-1" aria-label="Account">
          <Link href="/account/memory" className="btn btn-ghost btn-sm text-sm">
            My story
          </Link>
          <SignOutButton />
        </nav>
      </div>
    </header>
  );
}
