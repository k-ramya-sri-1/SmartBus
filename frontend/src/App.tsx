import { useState } from 'react'
import './App.css'
import DashboardLayout from './layouts/DashboardLayout'
import {
  BoardingRecords,
  Buses,
  Dashboard,
  EmergencyCenter,
  FaceEnrollment,
  LiveTracking,
  Login,
  Students,
} from './pages'
import type { PageKey } from './types'

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(
    () => Boolean(sessionStorage.getItem('smartbus_token')),
  )
  const [currentPage, setCurrentPage] = useState<PageKey>('dashboard')

  function handleLogin(token: string) {
    sessionStorage.setItem('smartbus_token', token)
    setIsLoggedIn(true)
  }

  function handleLogout() {
    sessionStorage.removeItem('smartbus_token')
    setIsLoggedIn(false)
  }

  if (!isLoggedIn) {
    return <Login onLogin={handleLogin} />
  }

  const pageDetails: Record<PageKey, { title: string; subtitle: string }> = {
    dashboard: {
      title: 'Dashboard',
      subtitle: "A clear view of today's transport operations.",
    },
    tracking: {
      title: 'Live Bus Tracking',
      subtitle: 'Follow the current fleet preview across campus routes.',
    },
    students: {
      title: 'Students',
      subtitle: 'Keep rider assignments and access records organized.',
    },
    buses: {
      title: 'Buses',
      subtitle: 'Monitor the fleet, capacity, and route readiness.',
    },
    boarding: {
      title: 'Boarding Records',
      subtitle: "Review static verification activity from today's routes.",
    },
    emergency: {
      title: 'Emergency Center',
      subtitle: 'Coordinate a fast, informed response to open incidents.',
    },
    enrollment: {
      title: 'Face Enrollment',
      subtitle: 'Enroll the face each student is verified against.',
    },
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'tracking':
        return <LiveTracking />
      case 'students':
        return <Students />
      case 'buses':
        return <Buses />
      case 'boarding':
        return <BoardingRecords />
      case 'emergency':
        return <EmergencyCenter />
      case 'enrollment':
        return <FaceEnrollment />
      default:
        return <Dashboard />
    }
  }

  return (
    <DashboardLayout
      currentPage={currentPage}
      onLogout={handleLogout}
      onNavigate={setCurrentPage}
      subtitle={pageDetails[currentPage].subtitle}
      title={pageDetails[currentPage].title}
    >
      {renderPage()}
    </DashboardLayout>
  )
}

export default App