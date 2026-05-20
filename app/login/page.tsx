import Image from "next/image";
import { LoginActions } from "@/components/login-actions";

type LoginPageProps = {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { redirect_url: redirectUrlParam } = await searchParams;
  const redirectUrl = Array.isArray(redirectUrlParam) ? redirectUrlParam[0] : redirectUrlParam;

  return (
    <main className="login-shell">
      <section className="login-panel" aria-label="AIC sign in">
        <div className="login-panel__image" aria-hidden="true">
          <Image
            src="/images/mountain-study/mountain-chapel.png"
            alt=""
            fill
            priority
            sizes="(max-width: 720px) 100vw, 42vw"
          />
        </div>
        <div className="login-panel__content">
          <div className="login-brand">
            <div>
              <strong>Pastor Jim Wood</strong>
              <span>Mountain Study Console</span>
            </div>
          </div>
          <div className="login-copy">
            <p className="eyebrow">Protected workspace</p>
            <h1>Sign in to the AIC console</h1>
            <p>
              Episode search, transcript reading, Podtrac stats, RAG chat, and LLM tools are available only after authentication.
            </p>
          </div>
          <LoginActions redirectUrl={redirectUrl} />
          <p className="login-note">
            Access is restricted to approved accounts. The public archive remains closed while the private research tools are being prepared.
          </p>
        </div>
      </section>
    </main>
  );
}
