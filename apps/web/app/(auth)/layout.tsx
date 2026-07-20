export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <span className="mb-8 text-xl font-semibold text-foreground">BOND OS</span>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
