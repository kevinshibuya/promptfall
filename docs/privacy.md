# Privacy

What the public server keeps, and how to have it removed.

The public server stores, for each account: an account id, a device token (the random key this
machine sends with every call), the game state (the party, the items, the gold, the market
listings and orders), and the GitHub login if the account is linked. It never stores the GitHub
access token: the link reads the login with it and drops it. Chat lines are kept under the poster's
name until newer messages push them out; the channel keeps the last 200. While the server runs, it
holds in memory who is online and in which zone for 45 seconds after the last poll, and the
address a new account came from for an hour, to cap new accounts per address; a restart forgets
both. Its log has one line per request (method, path, status, time taken), with no address, token
or body. Copies of the store are taken nightly: the newest seven stay on the server, and Cloudflare
R2 keeps each for thirty days.

Delete my account on this server, on the pane's Account tab, deletes the account, its token, its
listings and orders, and its leaderboard rows, then resets this machine's save. Copies taken before
the delete age out of the backups within thirty days. Chat lines already posted stay until pushed
out. To have anything else removed, ask in
[GitHub Discussions](https://github.com/kevinshibuya/promptfall/discussions).
