import type { auth } from '@socialIO/auth';

export type AppVariables = {
	user: typeof auth.$Infer.Session.user | null;
	session: typeof auth.$Infer.Session.session | null;
};

export type AppEnv = {
	Variables: AppVariables;
};
