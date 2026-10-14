import type {
  BoardingActivity,
  BoardingRecord,
  Bus,
  EmergencyAlert,
  Student,
} from '../types'

export const buses: Bus[] = [
  {
    id: 'B001',
    number: 'BUS001',
    route: 'Route A',
    capacity: 40,
    passengers: 28,
    status: 'Active',
  },
  {
    id: 'B002',
    number: 'BUS002',
    route: 'Route B',
    capacity: 40,
    passengers: 34,
    status: 'Active',
  },
  {
    id: 'B003',
    number: 'BUS003',
    route: 'Route C',
    capacity: 45,
    passengers: 31,
    status: 'Active',
  },
  {
    id: 'B004',
    number: 'BUS004',
    route: 'Route D',
    capacity: 35,
    passengers: 24,
    status: 'Maintenance',
  },
  {
    id: 'B005',
    number: 'BUS005',
    route: 'Route E',
    capacity: 40,
    passengers: 0,
    status: 'Inactive',
  },
]

export const students: Student[] = [
  {
    id: 'S001',
    name: 'Ramya Sri',
    rfid: 'RFID001',
    bus: 'BUS001',
    route: 'Route A',
    status: 'Active',
  },
  {
    id: 'S002',
    name: 'Arjun Kumar',
    rfid: 'RFID002',
    bus: 'BUS002',
    route: 'Route B',
    status: 'Active',
  },
  {
    id: 'S003',
    name: 'Meena Reddy',
    rfid: 'RFID003',
    bus: 'BUS001',
    route: 'Route A',
    status: 'Active',
  },
  {
    id: 'S004',
    name: 'Vikram Rao',
    rfid: 'RFID004',
    bus: 'BUS003',
    route: 'Route C',
    status: 'Active',
  },
  {
    id: 'S005',
    name: 'Ananya Das',
    rfid: 'RFID005',
    bus: 'BUS002',
    route: 'Route B',
    status: 'Inactive',
  },
]

export const boardingRecords: BoardingRecord[] = [
  {
    student: 'S001 / Ramya Sri',
    bus: 'BUS001',
    time: '08:12 AM',
    rfid: 'Verified',
    face: 'Verified',
    result: 'GRANTED',
  },
  {
    student: 'S002 / Arjun Kumar',
    bus: 'BUS002',
    time: '08:14 AM',
    rfid: 'Verified',
    face: 'Verified',
    result: 'GRANTED',
  },
  {
    student: 'S003 / Meena Reddy',
    bus: 'BUS001',
    time: '08:16 AM',
    rfid: 'Verified',
    face: 'Verified',
    result: 'GRANTED',
  },
  {
    student: 'S005 / Ananya Das',
    bus: 'BUS002',
    time: '08:19 AM',
    rfid: 'Verified',
    face: 'Not verified',
    result: 'DENIED',
  },
]

export const boardingActivity: BoardingActivity[] = [
  { student: 'Ramya Sri', bus: 'BUS001', time: '08:12 AM', result: 'GRANTED' },
  { student: 'Arjun Kumar', bus: 'BUS002', time: '08:14 AM', result: 'GRANTED' },
  { student: 'Meena Reddy', bus: 'BUS001', time: '08:16 AM', result: 'GRANTED' },
  { student: 'Ananya Das', bus: 'BUS002', time: '08:19 AM', result: 'DENIED' },
]

export const emergencyAlert: EmergencyAlert = {
  bus: 'BUS001',
  location: '17.3850, 78.4867',
  studentsOnboard: 27,
  status: 'OPEN',
}
