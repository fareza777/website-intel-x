"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="error-page"><h1>The terminal hit an unexpected error.</h1><p>Your saved research and local portfolio are preserved.</p><button onClick={reset}>Reload terminal</button></main>; }
