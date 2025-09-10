import { Button } from "@/components/ui/button";
import { getDb } from "@/db";
import { users } from "@/db/schema";

export default async function Home() {
  let status: string;
  try {
    // Simple query to validate DB connectivity
    const db = getDb();
    const result = await db.select({ count: users.id }).from(users).limit(1);
    status = `Połączenie z DB OK. Tabela users gotowa.`;
  } catch (e: any) {
    status = `DB niegotowa: ${e?.message ?? "brak połączenia"}`;
  }

  return (
    <main className="min-h-svh w-full p-8 flex flex-col items-start gap-6">
      <h1 className="text-2xl font-semibold">EHR starter (Next.js + shadcn + drizzle)</h1>
      <p className="text-sm text-muted-foreground">{status}</p>
      <div className="flex gap-3">
        <Button>Przycisk shadcn</Button>
        <Button variant="secondary">Secondary</Button>
      </div>
    </main>
  );
}
