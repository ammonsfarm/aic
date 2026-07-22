"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { SignInButton, SignUpButton, Show, UserButton } from "@clerk/nextjs";
import { consoleHomeHref, consoleNavForRole, publicNav, type AicNavRole } from "@/lib/navigation";

type TopRailProps = {
  variant: "private" | "public";
  isAdmin?: boolean;
  role?: AicNavRole;
};

export function TopRail({ variant, isAdmin = false, role }: TopRailProps) {
  const pathname = usePathname();
  const effectiveRole: AicNavRole = role ?? (isAdmin ? "Admin" : "User");
  const nav = variant === "private" ? consoleNavForRole(effectiveRole) : publicNav;
  const brandHref = variant === "private" ? consoleHomeHref(effectiveRole) : "/";

  return (
    <header className="top-rail">
      <Link href={brandHref} className="brand-mark" aria-label="Pastor Jim Wood — Abiding in Christ">
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
          const itemPath = item.href.split("#")[0];
          const active = item.href === "/" ? pathname === itemPath : pathname.startsWith(itemPath);
          const external = item.href.startsWith("http");
          if (item.children?.length) {
            return (
              <div className="top-rail__menu" key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-haspopup="true"
                  className="top-rail__menu-trigger"
                >
                  {item.label}
                  <span aria-hidden="true">v</span>
                </Link>
                <div className="top-rail__submenu" role="menu">
                  {item.children.map((child) => (
                    <Link href={child.href} key={child.href} role="menuitem">
                      <strong>{child.label}</strong>
                      <small>{child.description}</small>
                    </Link>
                  ))}
                </div>
              </div>
            );
          }
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
