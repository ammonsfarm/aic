"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { SignInButton, SignUpButton, Show, UserButton } from "@clerk/nextjs";
import { consoleNav, publicNav } from "@/lib/navigation";

type TopRailProps = {
  variant: "private" | "public";
  isAdmin?: boolean;
};

export function TopRail({ variant, isAdmin = false }: TopRailProps) {
  const pathname = usePathname();
  const nav = variant === "private" ? consoleNav.filter((item) => !item.adminOnly || isAdmin) : publicNav;

  return (
    <header className="top-rail">
      <Link href={variant === "private" ? "/overview" : "/"} className="brand-mark" aria-label="Pastor Jim Wood — Abiding in Christ">
        <span className="brand-mark__avatar">
          <Image
            src="/images/pastor-wood.jpg"
            alt="Pastor Jim Wood"
            fill
            sizes="44px"
            className="brand-mark__avatar-img"
          />
        </span>
        <span>
          <strong>Pastor Jim Wood</strong>
          <small>Abiding in Christ</small>
        </span>
      </Link>

      <nav className="top-rail__nav" aria-label={variant === "private" ? "Console navigation" : "Site navigation"}>
        {nav.map((item) => {
          const active = item.href === "/" ? pathname === item.href : pathname.startsWith(item.href);
          const external = item.href.startsWith("http");
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              target={external ? "_blank" : undefined}
              rel={external ? "noopener" : undefined}
            >
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
