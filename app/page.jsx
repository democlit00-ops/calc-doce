import { redirect } from "next/navigation";

export default function Home() {
  // Redireciona automaticamente para a dashboard
  redirect("/dashboard");
}
