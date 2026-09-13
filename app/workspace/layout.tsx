import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Workspace",
  description: "Your team's requirements, reviewed tests, CI evidence and release decisions.",
  // Private to signed-in teams; nothing here belongs in a search index.
  robots: { index: false, follow: false },
};

export default function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
