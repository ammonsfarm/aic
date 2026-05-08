"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignInButton, SignUpButton, Show, UserButton } from "@clerk/nextjs";
import { consoleNav, publicNav } from "@/lib/navigation";

type TopRailProps = {
  variant: "private" | "public";
};

export function TopRail({ variant }: TopRailProps) {
  const pathname = usePathname();
  const nav = variant === "private" ? consoleNav : publicNav;

  return (
    <header className="top-rail">
      <Link href={variant === "private" ? "/overview" : "/"} className="brand-mark" aria-label="AIC home">
        <span className="brand-mark__sigil" aria-hidden="true">AIC</span>
        <span>
          <strong>Mountain Study</strong>
          <small>Abiding in Christ</small>
        </span>
      </Link>

      <nav className="top-rail__nav" aria-label={variant === "private" ? "Console navigation" : "Site navigation"}>
        {nav.map((item) => {
          const active = item.href === "/" ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="top-rail__auth">
        <Show when="signed-out">
          <SignInButton mode="modal">
            <button className="button button--ghost" type="button">Sign in</button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button className="button button--primary" type="button">Sign up</button>
          </SignUpButton>
        </Show>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </div>
    </header>
  );
}
