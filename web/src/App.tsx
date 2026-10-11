import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { HomePage } from './pages/Home';
import { ReviewPage } from './pages/Review';
import { AppliersPage } from './pages/Appliers';
import { ApplierEditorPage } from './pages/ApplierEditor';
import { AppliedPage } from './pages/Applied';
import { SettingsPage } from './pages/Settings';
import { SetupPage } from './pages/Setup';
import { usePageTitle } from './lib/hooks';

function NotFound() {
  usePageTitle('Page not found');
  return (
    <div className="empty">
      <h1 className="h2">This page doesn't exist</h1>
      <Link className="btn btn-p" to="/">
        Go to Home
      </Link>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="review" element={<ReviewPage />} />
        <Route path="appliers" element={<AppliersPage />} />
        <Route path="appliers/new" element={<ApplierEditorPage />} />
        <Route path="appliers/:id" element={<ApplierEditorPage />} />
        <Route path="applied" element={<AppliedPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
