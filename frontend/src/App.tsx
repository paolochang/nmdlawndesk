import { useCallback, useEffect, useReducer } from 'react';
import { authReducer, loadAuth, saveAuth } from './lib/session.ts';
import { SignIn } from './SignIn.tsx';
import { Simulator } from './Simulator.tsx';

// The web SMS simulator (build-plan §7, §8): sign in, then the customer and
// Dave panels with the judgment log. Any 401 returns to the sign-in form with
// the nickname prefilled; signing in again opens the same environment.
export default function App() {
  const [auth, dispatch] = useReducer(authReducer, undefined, () =>
    loadAuth(localStorage, sessionStorage, Date.now()),
  );
  useEffect(() => saveAuth(auth, localStorage, sessionStorage), [auth]);
  const onUnauthorized = useCallback(() => dispatch({ type: 'unauthorized' }), []);

  if (auth.status === 'signed-out') {
    return (
      <SignIn
        nickname={auth.nickname}
        expired={auth.expired}
        onSignedIn={(nickname, session) => dispatch({ type: 'signed-in', nickname, session })}
      />
    );
  }
  return <Simulator session={auth.session} onUnauthorized={onUnauthorized} />;
}
