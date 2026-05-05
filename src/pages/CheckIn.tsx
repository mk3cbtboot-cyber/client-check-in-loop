import { Navigate, useParams } from "react-router-dom";

export default function CheckIn() {
  const { token } = useParams<{ token: string }>();
  if (!token) return <Navigate to="/" replace />;
  return <Navigate to={`/portal/${token}?tab=checkin`} replace />;
}
