import { ClerkArea } from "@/components/auth/clerk-area";

/** Clerk's own sign-up screen needs the provider and its UI bundle. */
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ClerkArea>{children}</ClerkArea>;
}
