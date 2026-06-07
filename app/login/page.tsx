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
          <div className="login-copy">
            <h1>Sign in to the AIC Podcast Console</h1>
          </div>
          <LoginActions redirectUrl={redirectUrl} />
        </div>
      </section>
    </main>
  );
}
