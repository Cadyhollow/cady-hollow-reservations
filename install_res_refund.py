import shutil, os

# Create the API route
src = os.path.expanduser('~/Downloads/reservation_refund_route.ts')
dst_dir = '/Users/charissachiaravalloti/cady-hollow-reservations/app/api/reservation-refund'
dst = dst_dir + '/route.ts'
os.makedirs(dst_dir, exist_ok=True)
shutil.copy2(src, dst)
print('  \u2713 Reservation refund API route created')

# Run the security fix script
import subprocess
result = subprocess.run(
    ['python3', '/Users/charissachiaravalloti/cady-hollow-reservations/fix_res_refund_security.py'],
    capture_output=True, text=True
)
print(result.stdout)
if result.stderr:
    print(result.stderr)
