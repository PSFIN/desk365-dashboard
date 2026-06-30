import json
import time
import urllib.request
import urllib.error
from datetime import datetime

API_KEY = "YOUR_API_KEY"
BASE_URL = "https://gulfcoast.desk365.io/apis/v3/tickets"

PER_PAGE = 100
MAX_RETRIES = 10


def fetch_json(url):
    retries = 0

    while True:
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": API_KEY,
                    "Accept": "application/json"
                }
            )

            with urllib.request.urlopen(req, timeout=60) as response:
                return json.loads(response.read())

        except urllib.error.HTTPError as e:

            if e.code == 429:

                retry_after = e.headers.get("Retry-After")

                if retry_after:
                    wait = int(retry_after)
                else:
                    wait = min(300, 2 ** retries)

                print(
                    f"429 received. Waiting {wait} seconds..."
                )

                time.sleep(wait)

                retries += 1

                if retries > MAX_RETRIES:
                    raise

                continue

            raise

        except Exception as e:

            retries += 1

            if retries > MAX_RETRIES:
                raise

            wait = min(300, 2 ** retries)

            print(
                f"Error: {e}. Retrying in {wait}s"
            )

            time.sleep(wait)


def fetch_all_tickets():
    all_tickets = []
    page = 1

    while True:

        url = (
            f"{BASE_URL}"
            f"?per_page={PER_PAGE}"
            f"&page={page}"
        )

        print(f"Fetching page {page}")

        data = fetch_json(url)

        tickets = data.get("data", [])

        if not tickets:
            break

        all_tickets.extend(tickets)

        print(
            f"Page {page}: {len(tickets)} tickets "
            f"(total={len(all_tickets)})"
        )

        page += 1

        # conservative pacing
        time.sleep(3)

    return all_tickets


def main():

    tickets = fetch_all_tickets()

    output = {
        "fetched_at": datetime.utcnow().strftime(
            "%b %d, %Y %H:%M UTC"
        ),
        "total_in_system": len(tickets),
        "count": len(tickets),
        "tickets": tickets
    }

    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)

    print(
        f"Saved {len(tickets)} tickets to data.json"
    )


if __name__ == "__main__":
    main()