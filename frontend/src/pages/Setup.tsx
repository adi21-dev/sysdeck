import { useEffect, useState } from "react"

export function SetupPage() {
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data) => {
        if (!data.is_setup_complete) {
          window.location.href = "/setup"
        } else {
          window.location.href = "/login"
        }
      })
      .catch(() => {
        window.location.href = "/setup"
      })
      .finally(() => setChecking(false))
  }, [])

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Checking setup status...</p>
      </div>
    )
  }

  return null
}
