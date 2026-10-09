import * as z from "zod";

export const LoginFormSchema = z.object({
  email: z.email({ error: "Enter a valid email address." }).trim(),
  password: z.string().min(1, { error: "Password is required." }),
});

export type LoginFieldErrors = {
  email?: string[];
  password?: string[];
};

export type FormState =
  | {
      errors?: LoginFieldErrors;
      message?: string;
    }
  | undefined;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
};
