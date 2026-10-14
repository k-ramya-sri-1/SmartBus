export type PageKey =
  | 'dashboard'
  | 'tracking'
  | 'students'
  | 'buses'
  | 'boarding'
  | 'emergency'

export type BusStatus = 'Active' | 'Inactive' | 'Maintenance'
export type EmergencyStatus = 'OPEN' | 'RESOLVED'

export interface Student {
  id: string
  name: string
  rfid: string
  bus: string
  route: string
  status: 'Active' | 'Inactive'
}

export interface Bus {
  id: string
  number: string
  route: string
  capacity: number
  passengers: number
  status: BusStatus
}

export interface BoardingRecord {
  student: string
  bus: string
  time: string
  rfid: 'Verified' | 'Not verified'
  face: 'Verified' | 'Not verified'
  result: 'GRANTED' | 'DENIED'
}

export interface BoardingActivity {
  student: string
  bus: string
  time: string
  result: 'GRANTED' | 'DENIED'
}

export interface EmergencyAlert {
  bus: string
  location: string
  studentsOnboard: number
  status: EmergencyStatus
}
