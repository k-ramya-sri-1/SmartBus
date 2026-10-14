const API_BASE_URL = 'http://localhost:5000/api'

export interface AuthUser {
  id: number
  username: string
  email: string
  role: 'ADMIN' | 'TRANSPORT_MANAGER' | 'DRIVER' | 'CONDUCTOR'
}

interface LoginResponse {
  success: boolean
  message: string
  token?: string
  user?: AuthUser
}

export async function loginUser(
  email: string,
  password: string,
): Promise<{ token: string; user: AuthUser }> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })

  const data = (await response.json()) as LoginResponse

  if (!response.ok || !data.success || !data.token || !data.user) {
    throw new Error(data.message || 'Login failed.')
  }

  return {
    token: data.token,
    user: data.user,
  }
}