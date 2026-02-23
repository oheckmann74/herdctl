export const onRequest: PagesFunction = async ({ request }) => {
	const url = new URL(request.url);
	const pathname = url.pathname.replace(/^\/ingest/, '');
	const search = url.search;

	return fetch(`https://us.i.posthog.com${pathname}${search}`, {
		method: request.method,
		headers: request.headers,
		body: request.body,
	});
};
