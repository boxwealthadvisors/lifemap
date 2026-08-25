import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Shell from './Shell';
import MockupHost from './MockupHost';
import { AdminUserProvider } from '../contexts/AdminUserContext';
import AdminInsurancePage from '../pages/AdminInsurancePage';

const PAGE_BY_SECTION = {
  dashboard: 'fp',
  assets: 'assets',
  'work-assets': 'work',
  goals: 'goals',
  loans: 'loans',
  expenses: 'expenses',
};

function sectionFromPath(path) {
  const clean = String(path || '').split('?')[0];
  if (clean === '/' || clean === '') return 'dashboard';
  if (clean === '/assets') return 'assets';
  if (clean === '/work-assets') return 'work-assets';
  if (clean === '/goals') return 'goals';
  if (clean === '/loans') return 'loans';
  if (clean === '/expenses') return 'expenses';
  if (clean === '/insurance') return 'insurance';
  return null;
}

export default function ClientPlanView({ clientId, clientName, onBack }) {
  const [activeSection, setActiveSection] = useState('dashboard');
  const { admin, adminLogout } = useAuth();

  const handleLogout = async () => {
    await adminLogout();
    window.location.href = '/';
  };

  return (
    <AdminUserProvider userId={clientId}>
      <div className="lm-admin-plan">
        <div className="lm-admin-plan-bar">
          <button type="button" className="lm-tlink" onClick={onBack}>← All clients</button>
          <span className="lm-admin-plan-who">Viewing {clientName}</span>
          <span className="lm-admin-plan-acts">
            <span>{admin?.name || admin?.username || 'Admin'}</span>
            <button type="button" className="lm-btn" onClick={handleLogout}>Logout</button>
          </span>
        </div>
        {activeSection === 'insurance' ? (
          <div className="lm-admin-plan-insurance">
            <Shell
              adminMode
              activeSection="insurance"
              onSectionChange={setActiveSection}
              adminUserName={admin?.name || admin?.username}
              userName={clientName}
              onBack={onBack}
            >
              <AdminInsurancePage />
            </Shell>
          </div>
        ) : (
          <MockupHost
            page={PAGE_BY_SECTION[activeSection]}
            accountLabel={clientName}
            onNavigate={(path) => {
              const next = sectionFromPath(path);
              if (next) setActiveSection(next);
            }}
            onExit={onBack}
          />
        )}
      </div>
    </AdminUserProvider>
  );
}
