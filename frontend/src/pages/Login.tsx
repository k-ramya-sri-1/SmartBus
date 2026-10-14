import { useState, type FormEvent } from 'react'
import { loginUser } from '../services/auth'

interface LoginProps {
  onLogin: (token: string) => void
}

function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const result = await loginUser(email.trim(), password)
      onLogin(result.token)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to log in. Please try again.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand-mark" aria-hidden="true">
          SB
        </div>

        <p className="login-kicker">Transport management system</p>
        <h1>Welcome to SmartBus</h1>
        <p className="login-intro">
          Sign in to monitor campus transport, boarding access, and safety operations.
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="Enter your email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            placeholder="Enter your password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          {error && (
            <p role="alert" className="login-error">
              {error}
            </p>
          )}

          <button
            className="primary-button login-submit"
            type="submit"
            disabled={isLoading}
          >
            {isLoading ? 'Signing in...' : 'Login'}
            <span aria-hidden="true"> →</span>
          </button>
        </form>

        <p className="demo-note">
          Sign in using an authorized SmartBus account.
        </p>
      </section>

      <aside className="login-aside">
        <p className="eyebrow">Campus mobility, made visible</p>
        <h2>Every journey deserves a clear view.</h2>
        <p>
          One place for route operations, boarding confidence, and rapid emergency response.
        </p>
        <div className="login-aside-rule" />
        <span>Phase 24 · Authentication</span>
      </aside>
    </main>
  )
}

export default Login