"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useClerk, useUser, UserButton } from "@clerk/nextjs";

const clerkAppearance = {
  variables: {
    colorPrimary: "oklch(34% 0.07 156)",
    colorText: "oklch(24% 0.025 235)",
    colorTextSecondary: "oklch(44% 0.025 230)",
    colorBackground: "oklch(96% 0.026 87)",
    colorInputBackground: "oklch(96% 0.026 87)",
    colorInputText: "oklch(24% 0.025 235)",
    borderRadius: "8px",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },
  elements: {
    cardBox: "aic-clerk-card",
    card: "aic-clerk-card",
    footer: "aic-clerk-footer",
    formButtonPrimary: "aic-clerk-primary",
  },
};

function safeRedirect(value: string | null) {
  if (value?.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  return "/overview";
}

export function LoginActions({ redirectUrl }: { redirectUrl?: string }) {
  const clerk = useClerk();
  const { isLoaded, isSignedIn } = useUser();
  const opened = useRef(false);
  const fallbackRedirectUrl = useMemo(() => safeRedirect(redirectUrl ?? null), [redirectUrl]);

  const openSignIn = useCallback(() => {
    clerk.openSignIn({
      appearance: clerkAppearance,
      fallbackRedirectUrl,
      withSignUp: false,
    });
  }, [clerk, fallbackRedirectUrl]);

  useEffect(() => {
    if (!isLoaded || isSignedIn || opened.current) {
      return;
    }

    opened.current = true;
    openSignIn();
  }, [isLoaded, isSignedIn, openSignIn]);

  if (isLoaded && isSignedIn) {
    return (
      <div className="login-actions">
        <Link className="button button--primary" href={fallbackRedirectUrl}>
          Continue
        </Link>
        <UserButton />
      </div>
    );
  }

  return (
    <div className="login-actions">
      <button className="button button--primary" type="button" onClick={openSignIn}>
        Sign in
      </button>
      <span>Access is limited to approved accounts.</span>
    </div>
  );
}
