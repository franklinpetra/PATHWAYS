"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}

export function SignInForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode: code }),
    });
    if (res.ok) {
      router.replace(safeNext(next));
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Something went wrong. Please try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-10 max-w-xl">
      <label htmlFor="access-code" className="block text-sm font-medium">
        Access code
      </label>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <input
          id="access-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
          placeholder="XXXX XXXX XXXX"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "access-code-error" : undefined}
          className="field flex-1 px-5 py-3 font-mono text-base tracking-[0.15em] placeholder:tracking-[0.15em]"
        />
        <button type="submit" disabled={pending || !code.trim()} className="btn btn-primary px-7 py-3 text-base">
          {pending ? "Signing in…" : "Continue"}
        </button>
      </div>
      {error && (
        <p id="access-code-error" role="alert" className="mt-3 text-sm text-muted-foreground">
          {error}
        </p>
      )}
    </form>
  );
}
