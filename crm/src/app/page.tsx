import { redirect } from "next/navigation";

// O proxy já redireciona; isto cobre o caso de ele não rodar
export default function Home() {
  redirect("/login");
}
