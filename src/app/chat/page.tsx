import { getCurrentUser } from "@/lib/dal";
import { logout } from "@/app/actions/auth";
import { ChatWindow } from "./chat-window";

export default async function ChatPage() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <header className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-lg font-semibold">Chat</h1>
          <p className="text-sm text-zinc-500">Signed in as {user.name}</p>
        </div>
        <form action={logout}>
          <button type="submit" className="rounded border px-3 py-1.5 text-sm">
            Sign out
          </button>
        </form>
      </header>

      <ChatWindow userName={user.name} />
    </main>
  );
}
