// /reagents/:id — wraps ReagentDetail with a 404 fallback.

import { Link, useParams } from 'react-router-dom';
import { ReagentDetail } from '../components/ReagentDetail';
import { useData } from '../data/store';

export function ReagentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const data = useData();
  const reagent = id ? data.reagentsById.get(id) : undefined;

  if (!reagent) {
    return (
      <div className="reagent-detail-missing">
        <h1>Reagent not found</h1>
        <p>
          No reagent with id <code>{id}</code> in the current data bundle.
        </p>
        <p>
          <Link to="/reagents">← back to reagents</Link>
        </p>
      </div>
    );
  }

  return <ReagentDetail reagent={reagent} />;
}
