import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.js';
import { Login } from './pages/Login.js';
import { Dashboard } from './pages/Dashboard.js';
import { SensorDetail } from './pages/SensorDetail.js';
import { AlarmConfigPage } from './pages/AlarmConfig.js';
import { Alarms } from './pages/Alarms.js';
import { Notifications } from './pages/Notifications.js';
import { AlarmSound } from './AlarmSound.js';
import './styles.css';

function Guard({ children }: { children: JSX.Element }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/login" />;
}

function Shell() {
  const { token, logout } = useAuth();
  return (
    <>
      <header>
        <strong>G7 Monitor</strong>
        {token && (
          <>
            <AlarmSound />
            <nav>
              <NavLink to="/">Dashboard</NavLink>
              <NavLink to="/alarms">Alarms</NavLink>
              <NavLink to="/notifications">Notifications</NavLink>
              <a href="#" onClick={(e) => { e.preventDefault(); logout(); location.href = '/login'; }}>Logout</a>
            </nav>
          </>
        )}
      </header>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Guard><Dashboard /></Guard>} />
        <Route path="/sensors/:id" element={<Guard><SensorDetail /></Guard>} />
        <Route path="/sensors/:id/config" element={<Guard><AlarmConfigPage /></Guard>} />
        <Route path="/alarms" element={<Guard><Alarms /></Guard>} />
        <Route path="/notifications" element={<Guard><Notifications /></Guard>} />
      </Routes>
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider><Shell /></AuthProvider>
    </BrowserRouter>
  );
}
