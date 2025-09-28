export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="w-full border-t bg-white/70 dark:bg-zinc-900/70">
      <div className="mx-auto max-w-6xl px-4 py-4 text-center text-xs sm:text-sm text-zinc-600 dark:text-zinc-300">
        © {year} • Criado por <span className="font-semibold">Kito Biten</span>
      </div>
    </footer>
  );
}
