import { useState, useEffect } from "react"

export function useClock() {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return {
    hours: time.getHours().toString().padStart(2, "0"),
    minutes: time.getMinutes().toString().padStart(2, "0"),
    seconds: time.getSeconds().toString().padStart(2, "0"),
    date: time.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
  }
}
