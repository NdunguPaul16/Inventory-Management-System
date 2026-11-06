import { Link } from 'react-router';
import { Card, PageHeader } from '../../../components/Card';

export function AccessDeniedPage() {
  return (
    <>
      <PageHeader title="Access denied" description="Your account cannot open this page." />
      <Card>
        <p className="text-sm text-slate-600">
          Ask an administrator for access if you need it for your work.
        </p>
        <Link
          to="/"
          className="mt-4 inline-block text-sm font-medium text-blue-700 hover:underline"
        >
          Return to dashboard
        </Link>
      </Card>
    </>
  );
}
