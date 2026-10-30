/**
 * Typed client for the SmartBus backend.
 *
 * Every call sends the staff JWT that was stored at login. A 401 clears the
 * session so the app falls back to the login screen instead of showing stale
 * data as if it were live.
 */

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api'

export class ApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function getToken(): string | null {
  return sessionStorage.getItem('smartbus_token')
}

export function clearToken(): void {
  sessionStorage.removeItem('smartbus_token')
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  auth?: boolean
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options
  const headers: Record<string, string> = {}

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  if (auth) {
    const token = getToken()

    if (!token) {
      throw new ApiError('Your session has expired. Please sign in again.', 401, 'NO_SESSION')
    }

    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 401 && auth) {
    clearToken()
  }

  const text = await response.text()
  let payload: unknown

  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = null
  }

  if (!response.ok) {
    const data = (payload ?? {}) as { message?: string; error?: string }
    throw new ApiError(
      data.message ?? `Request failed with status ${response.status}`,
      response.status,
      data.error,
    )
  }

  return payload as T
}

// --- Domain types ---------------------------------------------------------

export interface StudentRecord {
  id: number
  student_id: string
  name: string
  email: string | null
  phone: string | null
  status: 'ACTIVE' | 'INACTIVE'
  created_at?: string
  updated_at?: string
}

export interface BusRecord {
  id: number
  bus_number: string
  registration_number: string | null
  maximum_capacity: number
  status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE'
}

export interface RouteRecord {
  id: number
  route_name: string
  starting_point: string
  destination: string
  status: 'ACTIVE' | 'INACTIVE'
}

export interface AssignmentRecord {
  id: number
  student_id: number
  bus_id: number
  route_id: number
  assignment_status: 'ACTIVE' | 'INACTIVE' | 'EXPIRED'
  valid_from: string
  valid_to: string | null
}

export interface RfidCardRecord {
  id: number
  student_id: number
  student_code: string
  student_name: string
  rfid_uid: string
  status: 'ACTIVE' | 'INACTIVE' | 'LOST' | 'BLOCKED'
  issued_at: string
  last_verified_at: string | null
}

export interface BoardingRecordRow {
  id: number
  student_id: number | null
  student_code: string | null
  student_name: string | null
  bus_number: string | null
  route_name: string | null
  attempted_rfid_uid?: string | null
  authentication_mode: 'RFID' | 'CAMERA_ONLY' | null
  rfid_verified: 0 | 1 | boolean
  face_verified: 0 | 1 | boolean
  face_score: number | null
  access_result: 'GRANTED' | 'DENIED'
  denial_reason: string | null
  boarding_type: 'NORMAL' | 'RESCUE' | 'FEST'
  gps_status: string | null
  route_deviation_m: number | null
  boarded_at: string
}

export interface FaceEnrollmentRow {
  student_id: number
  student_code: string
  name: string
  status: string
  template_count: number
  engine: string | null
  verification_enabled: boolean
  last_enrolled_at: string | null
}

export interface FaceStatus {
  student: { id: number; student_id: string; name: string; status: string }
  face: {
    enrolled: boolean
    verification_enabled: boolean
    template_count: number
    engine: string | null
    last_enrolled_at: string | null
  }
}

export interface EmergencyRecord {
  id: number
  bus_id: number
  bus_number: string
  registration_number: string | null
  event_type: 'SOS' | 'BREAKDOWN' | 'ACCIDENT' | 'OTHER'
  description: string | null
  latitude: number | null
  longitude: number | null
  location_status: 'GPS_FIX' | 'GPS_STALE' | 'UNAVAILABLE'
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED'
  created_at: string
  resolved_at: string | null
}

export interface OperatingMode {
  mode: 'NORMAL' | 'FEST'
  active: boolean
  reason: string
  starts_at: string | null
  ends_at: string | null
}

export interface DeviceRecord {
  id: number
  device_uid: string
  bus_id: number
  bus_number: string
  label: string | null
  status: 'ACTIVE' | 'INACTIVE' | 'REVOKED'
  last_seen_at: string | null
  created_at: string
}

export interface GpsLocation {
  id: number
  bus_id: number
  bus_number: string
  registration_number: string | null
  latitude: number
  longitude: number
  speed: number | null
  fix_status: 'GPS_FIX' | 'GPS_STALE' | 'UNAVAILABLE'
  satellites: number | null
  hdop: number | null
  route_deviation_m: number | null
  recorded_at: string
  age_seconds?: number
  is_current?: boolean
}

// --- Endpoints ------------------------------------------------------------

export const api = {
  students: {
    list: () => request<{ students: StudentRecord[] }>('/students').then((r) => r.students),
    create: (payload: { student_id: string; name: string; email: string; phone?: string }) =>
      request<{ id: number }>('/students', { method: 'POST', body: payload }),
    update: (id: number, payload: Partial<StudentRecord>) =>
      request<{ success: boolean }>(`/students/${id}`, { method: 'PUT', body: payload }),
  },

  buses: {
    list: () => request<{ buses: BusRecord[] }>('/buses').then((r) => r.buses),
  },

  routes: {
    list: () => request<{ routes: RouteRecord[] }>('/routes').then((r) => r.routes),
  },

  assignments: {
    list: () =>
      request<{ assignments: AssignmentRecord[] }>('/assignments').then((r) => r.assignments),
  },

  rfid: {
    list: () => request<{ cards: RfidCardRecord[] }>('/rfid').then((r) => r.cards),
    register: (payload: { student_id: string; rfid_uid: string }) =>
      request<{ success: boolean }>('/rfid/register', { method: 'POST', body: payload }),
  },

  boarding: {
    list: () =>
      request<{ records: BoardingRecordRow[] }>('/boarding').then((r) => r.records),
  },

  face: {
    list: () =>
      request<{ enrollments: FaceEnrollmentRow[]; face_service_available: boolean }>('/face'),
    status: (studentId: number) => request<FaceStatus>(`/face/status/${studentId}`),
    enroll: (studentId: number, images: string[]) =>
      request<{ template_count: number; engine: string }>('/face/enroll', {
        method: 'POST',
        body: { student_id: studentId, images },
      }),
    remove: (studentId: number) =>
      request<{ success: boolean }>(`/face/enroll/${studentId}`, { method: 'DELETE' }),
  },

  emergency: {
    list: () =>
      request<{ events: EmergencyRecord[] }>('/emergency').then((r) => r.events),
    setStatus: (id: number, status: EmergencyRecord['status']) =>
      request<{ success: boolean }>(`/emergency/${id}/status`, {
        method: 'PUT',
        body: { status },
      }),
    allocate: (emergencyId: number) =>
      request<{
        allocated_student_count: number
        unallocated_student_count: number
        rescue_buses: Array<{ bus_number: string; rescue_capacity: number; distance_km: number }>
      }>('/rescue/allocate', {
        method: 'POST',
        body: { emergency_event_id: emergencyId, max_distance_km: 20 },
      }),
  },

  gps: {
    latest: (busId: number) => request<{ location: GpsLocation }>(`/gps/latest/${busId}`),
  },

  settings: {
    get: () => request<{ operating_mode: OperatingMode }>('/settings'),
    setOperatingMode: (payload: {
      mode: 'NORMAL' | 'FEST'
      starts_at?: string
      ends_at?: string
      route_deviation_enforce?: boolean
    }) =>
      request<{ operating_mode: OperatingMode }>('/settings/operating-mode', {
        method: 'PUT',
        body: payload,
      }),
  },

  devices: {
    list: () => request<{ devices: DeviceRecord[] }>('/devices').then((r) => r.devices),
  },
}
