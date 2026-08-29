import os

# Long enough to satisfy SHARED_SECRET_MIN_LENGTH so importing the app in tests
# exercises the same validation a real run does.
TEST_SHARED_SECRET = "cadence-test-shared-secret-value-0123456789"

os.environ.setdefault("CADENCE_SHARED_SECRET", TEST_SHARED_SECRET)
