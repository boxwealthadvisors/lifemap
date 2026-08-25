import React from 'react';
import { useAdminUser } from '../contexts/AdminUserContext';
import InsurancePage from './InsurancePage';
import ErrorBoundary from '@/components/ErrorBoundary';

export default function AdminInsurancePage() {
  const { userId } = useAdminUser();
  
  if (!userId) {
    return <div>No client selected</div>;
  }

  return (
    <ErrorBoundary>
      <InsurancePage />
    </ErrorBoundary>
  );
}

