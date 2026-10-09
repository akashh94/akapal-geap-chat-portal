import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold">Sign in</h1>
        <p className="mb-6 text-sm text-zinc-500">
          Demo user: demo@example.com / demo1234
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
