try {
  const response = await fetch("http://127.0.0.1:8080/health/live", {
    signal: AbortSignal.timeout(3000),
  });
  await response.body?.cancel();
  if (!response.ok) process.exit(1);
} catch {
  process.exit(1);
}
