import { cache } from "react";
import { redirect } from "next/navigation";
import { decryptSession, readSessionToken } from "./session";
import { findUserById } from "./db";
import type { SessionUser } from "./definitions";

export async function getSessionUserId(): Promise<string | null> {
  const token = await readSessionToken();
  const payload = await decryptSession(token);
  return payload?.userId ?? null;
}

export const verifySession = cache(async () => {
  const userId = await getSessionUserId();

  if (!userId) {
    redirect("/login");
  }

  return { userId };
});

export const getCurrentUser = cache(async (): Promise<SessionUser> => {
  const { userId } = await verifySession();
  const user = findUserById(userId);

  if (!user) {
    redirect("/login");
  }

  return { id: user.id, name: user.name, email: user.email };
});
