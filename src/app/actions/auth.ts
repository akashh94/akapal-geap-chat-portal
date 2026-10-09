"use server";

import { redirect } from "next/navigation";
import {
  LoginFormSchema,
  type FormState,
  type LoginFieldErrors,
} from "@/lib/definitions";
import { findUserByEmail } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession, deleteSession } from "@/lib/session";

export async function login(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = LoginFormSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const errors: LoginFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "email" || field === "password") {
        (errors[field] ??= []).push(issue.message);
      }
    }
    return { errors };
  }

  const { email, password } = parsed.data;
  const user = findUserByEmail(email);

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return { message: "Invalid email or password." };
  }

  await createSession(user.id);
  redirect("/chat");
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/login");
}
