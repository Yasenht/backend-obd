# OBD App API

Backend API for vehicle profiles, OBD-II scan ingestion, health reporting,
and AI-assisted diagnostic explanations. It is built on the Epic API
framework with Deno, Oak, and MongoDB.

### Quick Start

```sh
# Clone the repository
git clone https://github.com/Oridune/epic-api.git my-new-app
```

### Environment variables are required

In order to run the following repository you need to make sure that the
directory where you cloned this repository contains the required environment
files. You need to create the following files:\
./env/.development.env\
./env/.production.env\
./env/.test.env

You can copy the initial environment variables content from `./.sample.env`
and modify them. `JWT_SECRET` is mandatory and must be a unique value of at
least 32 characters. Configure `GEMINI_API_KEY` to enable the AI analysis
endpoints.

### Existing MongoDB deployments

Vehicle ownership is now scoped by account and uses the public `veh_...` id
returned by `POST /api/vehicles/`. Before deploying this version against an
existing database, back it up and migrate legacy vehicles to an account. The
previous global `vin_unique` and `profile_vin` indexes must then be replaced
with the new account-scoped indexes declared by the application. This is not
performed automatically because removing a production index is an operational
and potentially disruptive action.

### Execute the following commands to run the application on your local machine:

```sh
# For development server
deno task dev

# For production
deno task start

# For test
deno task test
```

### Always keep your application updated!

You should always keep your application updated in order to fix any possible
vulnerabilities or bugs. You can update the core of this application by running
the following command.

```sh
# Following command updates the core of the application and make sure that the application has the latest security patches.
deno task update:core
```

### Collaborators

If you want to collaborate on this project than fork this project on your github
account and use the .sample.env file to setup the environment variables.

**See the
[branching strategy guide](https://dev.to/ak_23/branching-strategy-guide-24d6)
for the best collaboration practices when working with github repositories.**
