import { ClerkArea } from "@/components/auth/clerk-area";

/** The first step after signing up reads the session. */
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClerkArea>{children}</ClerkArea>;
}
