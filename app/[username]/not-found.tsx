import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-4xl font-bold">No page here yet</h1>
      <p className="mt-3 max-w-sm text-mute">
        Nobody has claimed this username. It could be yours.
      </p>
      <Link href="/register" className="btn-primary mt-8">
        Claim it
      </Link>
    </main>
  );
}
